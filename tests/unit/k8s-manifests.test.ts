import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * The deployment manifests.
 *
 * There is no cluster here to apply these to, so these tests check the things
 * that are cheap to get wrong and expensive to discover in a cluster: broken
 * YAML, a reference to a Secret key that nothing defines, a volume nobody
 * claims, a probe pointing at a port that does not exist.
 */
const DIR = path.join(process.cwd(), "k8s");

type Doc = Record<string, any>;

function loadOne(file: string): Doc {
  const [doc] = load(file);
  expect(doc, `${file} is empty`).toBeTruthy();
  return doc as Doc;
}

function load(file: string): Doc[] {
  const docs = parseAllDocuments(readFileSync(path.join(DIR, file), "utf8"));
  for (const doc of docs) {
    expect(doc.errors, `${file} has YAML errors`).toEqual([]);
  }
  return docs.map((doc) => doc.toJS()).filter(Boolean);
}

const files = readdirSync(DIR).filter((file) => file.endsWith(".yaml"));
const all = files.flatMap((file) => load(file).map((doc) => ({ file, doc })));
const byKind = (kind: string) => all.filter((entry) => entry.doc.kind === kind).map((e) => e.doc);

/**
 * Every `secretKeyRef` / `configMapKeyRef` anywhere in the tree.
 *
 * Walked rather than pattern-matched: the manifests use both the block and the
 * inline `{ name: x, key: y }` form, and a regex that quietly missed one of
 * them would make this whole check decorative.
 */
function collectRefs(kind: "secretKeyRef" | "configMapKeyRef"): { file: string; key: string }[] {
  const found: { file: string; key: string }[] = [];

  function walk(node: unknown, file: string): void {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, file);
      return;
    }
    if (!node || typeof node !== "object") return;

    for (const [property, value] of Object.entries(node as Record<string, unknown>)) {
      if (property === kind && value && typeof value === "object") {
        const ref = value as { name?: string; key?: string };
        if (ref.name === "dober-dan" && ref.key) found.push({ file, key: ref.key });
      }
      walk(value, file);
    }
  }

  for (const { file, doc } of all) walk(doc, file);
  return found;
}

describe("every manifest", () => {
  it("parses and names its kind and namespace", () => {
    expect(files.length).toBeGreaterThan(5);
    for (const { file, doc } of all) {
      expect(doc.apiVersion, `${file} has no apiVersion`).toBeTruthy();
      expect(doc.kind, `${file} has no kind`).toBeTruthy();
      if (doc.kind !== "Namespace" && doc.kind !== "Kustomization") {
        expect(doc.metadata?.namespace, `${file}/${doc.kind} has no namespace`).toBe(
          "dober-dan",
        );
      }
    }
  });

  it("sets resource requests and limits on every container", () => {
    for (const { file, doc } of all) {
      const containers = [
        ...(doc.spec?.template?.spec?.containers ?? []),
        ...(doc.spec?.jobTemplate?.spec?.template?.spec?.containers ?? []),
      ];
      for (const container of containers) {
        expect(container.resources?.requests, `${file}/${container.name} requests`).toBeTruthy();
        expect(container.resources?.limits, `${file}/${container.name} limits`).toBeTruthy();
      }
    }
  });
});

describe("configuration references", () => {
  /** A key referenced but never defined is a pod that crash-loops on boot. */
  it("only reads Secret keys the example Secret defines", () => {
    const secret = loadOne("secret.example.yaml");
    const defined = new Set(Object.keys(secret?.stringData ?? {}));
    expect(defined.size).toBeGreaterThan(0);

    const referenced = collectRefs("secretKeyRef");
    expect(referenced.length).toBeGreaterThan(0);
    for (const { file, key } of referenced) {
      expect(defined, `${file} uses Secret key ${key}, which is not defined`).toContain(key);
    }
  });

  it("only reads ConfigMap keys the ConfigMap defines", () => {
    const config = loadOne("config.yaml");
    const defined = new Set(Object.keys(config?.data ?? {}));

    const referenced = collectRefs("configMapKeyRef");
    expect(referenced.length).toBeGreaterThan(0);
    for (const { file, key } of referenced) {
      expect(defined, `${file} uses ConfigMap key ${key}, which is not defined`).toContain(key);
    }
  });
});

describe("storage", () => {
  it("claims every volume a pod mounts", () => {
    const claims = new Set([
      ...byKind("PersistentVolumeClaim").map((doc) => doc.metadata.name),
      // StatefulSet volumeClaimTemplates create their own.
      ...byKind("StatefulSet").flatMap((doc) =>
        (doc.spec.volumeClaimTemplates ?? []).map((template: Doc) => template.metadata.name),
      ),
    ]);

    for (const { file, doc } of all) {
      const spec = doc.spec?.template?.spec ?? doc.spec?.jobTemplate?.spec?.template?.spec;
      for (const volume of spec?.volumes ?? []) {
        if (!volume.persistentVolumeClaim) continue;
        expect(claims, `${file} mounts unclaimed volume ${volume.name}`).toContain(
          volume.persistentVolumeClaim.claimName,
        );
      }
    }
  });

  /**
   * Every volume here is ReadWriteOnce, so a rolling update would deadlock:
   * the new pod waits for a volume the old one has not released.
   */
  it("recreates rather than rolls the deployments that hold a volume", () => {
    for (const deployment of byKind("Deployment")) {
      const holdsVolume = (deployment.spec.template.spec.volumes ?? []).some(
        (volume: Doc) => volume.persistentVolumeClaim,
      );
      if (!holdsVolume) continue;
      expect(
        deployment.spec.strategy?.type,
        `${deployment.metadata.name} holds a volume and must not roll`,
      ).toBe("Recreate");
    }
  });
});

describe("services and probes", () => {
  it("points every Service at a port its pods actually open", () => {
    const containerPorts = new Map<string, Set<number>>();
    for (const doc of [...byKind("Deployment"), ...byKind("StatefulSet")]) {
      const name = doc.spec.selector.matchLabels["app.kubernetes.io/name"];
      const ports = new Set<number>(
        doc.spec.template.spec.containers.flatMap((container: Doc) =>
          (container.ports ?? []).map((port: Doc) => port.containerPort),
        ),
      );
      containerPorts.set(name, ports);
    }

    for (const service of byKind("Service")) {
      const selector = service.spec.selector["app.kubernetes.io/name"];
      const ports = containerPorts.get(selector);
      expect(ports, `Service ${service.metadata.name} selects nothing`).toBeTruthy();
      for (const port of service.spec.ports) {
        expect(ports, `Service ${service.metadata.name} targets a closed port`).toContain(
          port.targetPort,
        );
      }
    }
  });

  it("probes named ports the container declares", () => {
    for (const doc of [...byKind("Deployment"), ...byKind("StatefulSet")]) {
      for (const container of doc.spec.template.spec.containers) {
        const names = new Set((container.ports ?? []).map((port: Doc) => port.name));
        for (const probe of [
          container.readinessProbe,
          container.livenessProbe,
          container.startupProbe,
        ]) {
          if (!probe?.httpGet) continue;
          expect(names, `${container.name} probes unknown port ${probe.httpGet.port}`).toContain(
            probe.httpGet.port,
          );
        }
      }
    }
  });

  /**
   * The whole point of the readiness split: the app is not ready without a
   * database, but Piper and Whisper being down is a degradation, not an
   * outage, and must not take the app out of service.
   */
  it("gates the app on /api/ready and not on the speech services", () => {
    const app = byKind("Deployment").find((doc) => doc.metadata.name === "app");
    const container = app!.spec.template.spec.containers[0];
    expect(container.readinessProbe.httpGet.path).toBe("/api/ready");
    expect(container.livenessProbe.httpGet.path).toBe("/api/health");
    // Migrations run at boot and need room; liveness must not fire meanwhile.
    expect(container.startupProbe).toBeTruthy();
  });
});

describe("the backup CronJob", () => {
  it("runs the script from the repo rather than a copy", () => {
    const kustomization = loadOne("kustomization.yaml");
    const generator = kustomization.configMapGenerator.find(
      (entry: Doc) => entry.name === "backup-scripts",
    );
    expect(generator.files).toContain("backup.sh=../scripts/ops/backup.sh");
    // A hashed name would leave the CronJob's reference dangling.
    expect(kustomization.generatorOptions.disableNameSuffixHash).toBe(true);

    const cron = byKind("CronJob")[0] as Doc;
    const spec = cron.spec.jobTemplate.spec.template.spec;
    expect(spec.containers[0].command).toEqual(["sh", "/scripts/backup.sh"]);
    expect(spec.volumes.some((volume: Doc) => volume.configMap?.name === "backup-scripts")).toBe(
      true,
    );
  });

  it("never runs two backups at once", () => {
    for (const cron of byKind("CronJob")) {
      expect(cron.spec.concurrencyPolicy).toBe("Forbid");
      expect(cron.spec.timeZone).toBeTruthy();
    }
  });
});

describe("kustomization", () => {
  it("lists every manifest except the secret", () => {
    const kustomization = loadOne("kustomization.yaml");
    const listed = new Set<string>(kustomization.resources);

    for (const file of files) {
      if (file === "kustomization.yaml") continue;
      if (file === "secret.example.yaml") {
        expect(listed, "the example secret must not be applied").not.toContain(file);
        continue;
      }
      expect(listed, `${file} is not in kustomization.yaml`).toContain(file);
    }
  });
});
