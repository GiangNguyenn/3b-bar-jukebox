import type { Metadata } from "next";
import { Belgrano } from "next/font/google";
import "./globals.css";
import { HeroUIProvider } from "@heroui/react";
import Header from "@/components/Header";

// const geistSans = localFont({
//   src: "./fonts/GeistVF.woff",
//   variable: "--font-geist-sans",
//   weight: "100 900",
// });
// const geistMono = localFont({
//   src: "./fonts/GeistMonoVF.woff",
//   variable: "--font-geist-mono",
//   weight: "100 900",
// });

const belgrano = Belgrano({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-belgrano",
});

export const metadata: Metadata = {
  title: "3B SAIGON JUKEBOX",
  description: "A boutique beer & music experience",
  keywords: "jukebox, live music, craft beer, Saigon, Ho Chi Minh City, bar, music venue",
  authors: [{ name: "3B Saigon" }],
  creator: "3B Saigon",
  publisher: "3B Saigon",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://3bsaigonjukebox.com",
    siteName: "3B SAIGON JUKEBOX",
    title: "3B SAIGON JUKEBOX",
    description: "A boutique beer & music experience",
    images: [
      {
        url: "/images/og-image.jpg", // You'll need to add this image
        width: 1200,
        height: 630,
        alt: "3B SAIGON JUKEBOX - A boutique beer & music experience",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "3B SAIGON JUKEBOX",
    description: "A boutique beer & music experience",
    images: ["/images/og-image.jpg"], // Same image as OpenGraph
    creator: "@3bsaigon", // Add your Twitter handle if you have one
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "your-google-site-verification", // Add your Google Search Console verification code
  },
  alternates: {
    canonical: "https://3bsaigonjukebox.com", // Add your actual domain
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="">
      <body className={`${belgrano.variable} antialiased min-h-screen`}>
        <HeroUIProvider>
          <Header />
          {children}
        </HeroUIProvider>
      </body>
    </html>
  );
}
