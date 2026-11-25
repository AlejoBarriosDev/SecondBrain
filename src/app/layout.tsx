import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/lib/ui/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "SecondBrain — Personal Life OS",
  description:
    "Centro de comando personal Life OS — Módulo 1: Finanzas Personales",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased selection:bg-indigo-500/30">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
