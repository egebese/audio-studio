"use client";

import { useState, type FormEvent } from "react";
import styles from "./login.module.css";

const GENERIC_ERROR = "Unable to sign in. Check the password and try again.";

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: form.get("password") })
      });
      if (!response.ok) throw new Error("Login failed");
      window.location.replace("/");
    } catch {
      setError(GENERIC_ERROR);
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label htmlFor="studio-password">Password</label>
      <input
        id="studio-password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        disabled={pending}
      />
      <button type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Enter studio"}
      </button>
      <p className={styles.error} role="status" aria-live="polite">
        {error}
      </p>
    </form>
  );
}
