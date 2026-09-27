import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (SIL Open Font License 1.1, via Fontsource) so the canvas never
// has to reach a font CDN before it renders. See src/app/fonts/README.md.
const instrumentSans = localFont({
  variable: "--font-sans-face",
  display: "swap",
  src: [
    { path: "./fonts/instrument-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/instrument-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/instrument-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

const instrumentSerif = localFont({
  variable: "--font-serif-face",
  display: "swap",
  src: [{ path: "./fonts/instrument-serif-latin-400-normal.woff2", weight: "400", style: "normal" }],
});

const jetbrainsMono = localFont({
  variable: "--font-mono-face",
  display: "swap",
  src: [
    { path: "./fonts/jetbrains-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "OmniOS · SyberLabs",
  description: "Spatial AI workspace. See the sources behind an answer.",
  keywords: ["SyberLabs", "OmniOS", "AI workspace", "provenance", "prediction markets", "data canvas"],
};

export const viewport: Viewport = {
  themeColor: "#05060A",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
