import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";


export const metadata: Metadata = {
  title: "Modern Indian School — Timetable Management System",
  description: "Automated conflict-free timetable generation for Modern Indian School 2025-26",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground"
      >
        {children}
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
