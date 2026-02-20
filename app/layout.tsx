import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FrogNav Planner",
  description: "8-term academic planning wizard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
