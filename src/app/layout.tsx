import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "System Design Tycoon",
  description:
    "Learn large-scale system design by building, breaking, and fixing architectures under realistic simulated load.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}
