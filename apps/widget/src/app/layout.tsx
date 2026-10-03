export const metadata = {
  title: "HelpFlow Widget",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Transparent so only the launcher and panel are visible inside the host page's iframe. */}
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}
