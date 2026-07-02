import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audio Studio",
  description: "Audio-only Creator Studio for fal audio models."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
