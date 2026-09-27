import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HelpFlow AI",
  description: "Multi-tenant AI customer support SaaS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
