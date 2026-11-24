import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SecondBrain — Personal Life OS",
  description: "Modular Personal Life OS Command Center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
