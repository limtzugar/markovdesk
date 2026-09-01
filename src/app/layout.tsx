import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Markov Desk — HMM × LLM Trading on Bybit",
  description:
    "Algorithmic trading bot combining Hidden Markov Models with LLM reasoning, paper-trading on Bybit. Based on Andersson & Fransson (2016), University of Gothenburg.",
  keywords: [
    "HMM",
    "Hidden Markov Model",
    "LLM trading",
    "Bybit",
    "algorithmic trading",
    "Viterbi",
    "Baum-Welch",
  ],
  authors: [{ name: "Markov Desk" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
