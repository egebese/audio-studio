import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Sign in | Audio Studio"
};

export default function LoginPage() {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.eyebrow}>
          <span aria-hidden="true" />
          SELF-HOSTED
        </div>
        <header className={styles.header}>
          <h1 id="login-title">Audio Studio</h1>
          <p>Enter the studio password to continue.</p>
        </header>
        <LoginForm />
      </section>
    </main>
  );
}
