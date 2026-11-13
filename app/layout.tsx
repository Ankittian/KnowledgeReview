import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Knowledge Review", template: "%s · Knowledge Review" },
  description: "Daily flashcards that verify the SpectrumERP knowledge base.",
  applicationName: "Knowledge Review",
  appleWebApp: { capable: true, title: "Knowledge Review", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0f1d" },
  ],
};

// Applies the saved theme before first paint (no flash).
const themeScript = `try{var t=localStorage.getItem("kr_theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        {/* next/script (not a raw <script>) so React 19 does not warn; runs before hydration, so no theme flash */}
        <Script id="kr-theme" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
