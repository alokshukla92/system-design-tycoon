import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "System Design Tycoon",
  description:
    "Learn large-scale system design by building, breaking, and fixing architectures under realistic simulated load.",
};

// Applies the persisted theme before first paint to avoid a flash of the
// wrong theme. Runs inline in <head>.
const themeScript = `(function(){try{var t=localStorage.getItem('sdt-theme');if(t==='light')document.documentElement.classList.add('light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}
