"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "@/lib/auth/actions";

type Labels = {
  email: string;
  password: string;
  submit: string;
  pending: string;
  invalidCredentials: string;
  missingFields: string;
  unexpectedError: string;
};

function SubmitButton({ labels }: { labels: Labels }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block disabled={pending}>
      {pending ? labels.pending : labels.submit}
    </Button>
  );
}

export function LoginForm({ labels }: { labels: Labels }) {
  const [state, action] = useActionState<LoginState, FormData>(login, {});
  const [email, setEmail] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.error) {
      if (state.email !== undefined) setEmail(state.email);
      passwordRef.current?.focus();
    }
  }, [state.error, state.email]);

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{labels.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={state.error ? "login-error" : undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{labels.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          ref={passwordRef}
          aria-describedby={state.error ? "login-error" : undefined}
        />
      </div>

      {state.error ? (
        <p id="login-error" role="alert" className="text-sm text-destructive">
          {labels[state.error]}
        </p>
      ) : null}

      <SubmitButton labels={labels} />
    </form>
  );
}
