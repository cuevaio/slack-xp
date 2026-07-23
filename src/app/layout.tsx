import { ClerkProvider } from "@clerk/nextjs";
import { GeistPixelSquare } from "geist/font/pixel";
import type { Metadata, Viewport } from "next";
import { InteractionFeedback } from "@/components/interaction-feedback";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portal Messenger: Corporate Edition",
  description: "A playful communal online office.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistPixelSquare.variable} h-full`}>
      <body>
        <InteractionFeedback />
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
