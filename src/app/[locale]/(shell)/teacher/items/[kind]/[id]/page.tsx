import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { requireTeacher } from "@/lib/auth";
import { getContentItem, type ContentKind } from "@/lib/teacher/content";
import { ItemEditor } from "./item-editor";

export default async function TeacherItemPage({
  params,
}: {
  params: Promise<{ locale: string; kind: string; id: string }>;
}) {
  const { locale, kind, id } = await params;
  setRequestLocale(locale);

  await requireTeacher();
  const t = await getTranslations("teacher.item");

  if (kind !== "phrase" && kind !== "lexeme") notFound();

  const item = await getContentItem(db, kind as ContentKind, id);
  if (!item) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 py-10">
        <p className="text-muted-foreground">{t("notFound")}</p>
        <Link href="/teacher/content" className="text-primary underline-offset-4 hover:underline">
          {t("back")}
        </Link>
      </main>
    );
  }

  return <ItemEditor item={item} />;
}
