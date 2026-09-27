import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// SyberLabs Atlas v2 type: Instrument Sans (UI + body), Instrument Serif
// (large headings only, never below 32px), JetBrains Mono (labels, numbers).
const instrumentSans = Instrument_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  fallback: ["system-ui", "sans-serif"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  fallback: ["Georgia", "serif"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: "The Citadel | Project Omni",
  description: "A sovereign, high-bandwidth cognitive exoskeleton. Your Cognitive Integrated Development Environment.",
  keywords: ["cognitive IDE", "prediction markets", "data visualization", "AI", "productivity"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
