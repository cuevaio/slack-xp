import { ClerkProvider } from "@clerk/nextjs";
import { GeistPixelSquare } from "geist/font/pixel";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portal Messenger: Corporate Edition",
  description: "A playful communal online office.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistPixelSquare.variable} h-full`}>
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
