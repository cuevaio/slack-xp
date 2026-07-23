import { ClerkProvider } from "@clerk/nextjs";
import { GeistPixelSquare } from "geist/font/pixel";
import type { Metadata } from "next";
import { readAppConfiguration } from "@/lib/config";
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
  const configuration = readAppConfiguration();
  const content =
    configuration.status === "ready" && configuration.serviceMode === "live" ? (
      <ClerkProvider>{children}</ClerkProvider>
    ) : (
      children
    );

  return (
    <html lang="en" className={`${GeistPixelSquare.variable} h-full`}>
      <body>{content}</body>
    </html>
  );
}
