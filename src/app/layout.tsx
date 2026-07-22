import { GeistPixelSquare } from "geist/font/pixel";
import type { Metadata } from "next";
import { InteractionFeedback } from "@/components/interaction-feedback";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portal Messenger: Corporate Edition",
  description: "A communal realtime office powered by Portal.",
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
        {children}
      </body>
    </html>
  );
}
