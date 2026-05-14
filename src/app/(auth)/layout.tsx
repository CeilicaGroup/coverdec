export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center bg-gradient-to-br from-background via-secondary/30 to-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="text-3xl font-black tracking-tight">CONTRACT+</div>
          <div className="text-[10px] font-bold tracking-[0.3em] text-primary uppercase mt-1">
            Coverdec Innovación SL
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
