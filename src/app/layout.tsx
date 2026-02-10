import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Analytics from "@/components/Analytics";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MAYA Downloads | Access the Narrative Universe",
  description: "Free access to assets, lore, and content from the MAYA Narrative universe.",
  keywords: ["MAYA", "MAYAVerse", "Downloads", "Free Assets", "Narrative Universe"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black min-h-screen flex flex-col`}
      >
        <Analytics />
        <Navbar />
        <main className="flex-grow">
          {children}
        </main>
        <footer className="border-t border-brand-gray/50 py-8 bg-black">
          <div className="max-w-7xl mx-auto px-4 text-center">
            <p className="text-gray-500 text-sm font-mono tracking-widest uppercase">
              © {new Date().getFullYear()} MAYA Narrative Universe. All Rights Reserved.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
