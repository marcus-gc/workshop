export const metadata = {
  title: "Example Project",
  description: "A simple Next.js app for testing Workshop Craftsmen",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
