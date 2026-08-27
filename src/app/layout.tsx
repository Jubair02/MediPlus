import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MediPlus — Online Pharmacy in Bangladesh",
  description:
    "Order genuine medicines online with doorstep delivery. Upload prescriptions, get pharmacist verification, and track your orders live.",
  keywords: ["pharmacy", "medicine", "e-pharmacy", "Bangladesh", "online medicine", "prescription"],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "MediPlus — Online Pharmacy",
    description: "Genuine medicines delivered to your door",
    siteName: "MediPlus",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
