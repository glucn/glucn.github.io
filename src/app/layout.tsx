import type { Metadata } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";

import "./globals.css";

export const metadata: Metadata = {
  title: "glucn.github.io",
  description: "glucn blog",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <GoogleAnalytics gaId="G-B8P5T02T2B" />
      <body>{children}</body>
    </html>
  );
}
