import { Link } from "wouter";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Settings, Building2, Contact, CircleCheck as CheckCircle, LogOut, Plug, Loader as Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function More() {
  const { logout, user } = useAuth();
  const [diag, setDiag] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function testRentec() {
    setTesting(true);
    setDiag(null);
    try {
      const r = await fetch(`${API_BASE}/api/rentec/diag`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("kc_token")}` },
      });
      const json = await r.json();
      setDiag(JSON.stringify(json, null, 2));
    } catch (err) {
      setDiag(`Request failed: ${String(err)}`);
    } finally {
      setTesting(false);
    }
  }

  const links = [
    { href: "/properties", icon: <Building2 className="w-6 h-6" />, title: "Properties", desc: "Properties, units & payment status" },
    { href: "/tasks", icon: <CheckCircle className="w-6 h-6" />, title: "Tasks", desc: "Your personal task list" },
    { href: "/directory", icon: <Contact className="w-6 h-6" />, title: "Directory", desc: "Tenant & contact directory" },
    ...(user?.role === "jacob"
      ? [{ href: "/evictions", icon: <Scale className="w-6 h-6" />, title: "Evictions", desc: "Track eviction cases, court dates, documents & write-offs" }]
      : []),
    { href: "/settings", icon: <Settings className="w-6 h-6" />, title: "Settings", desc: "App preferences and account" },
  ];

  return (
    <div className="pb-24">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-2xl font-bold">More</h1>
      </div>

      <div className="p-4 space-y-3">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="hover-elevate cursor-pointer mb-3">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="bg-primary/10 p-3 rounded-full text-primary">
                  {link.icon}
                </div>
                <div>
                  <h3 className="font-bold text-lg">{link.title}</h3>
                  <p className="text-sm text-muted-foreground">{link.desc}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}

        {/* Rentec connection test — surfaces the live API result for debugging */}
        <Card className="mb-3">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="bg-primary/10 p-3 rounded-full text-primary">
                <Plug className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">Rentec connection test</h3>
                <p className="text-sm text-muted-foreground">Check the live API and show what it returns</p>
              </div>
              <Button variant="outline" onClick={testRentec} disabled={testing}>
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Run"}
              </Button>
            </div>
            {diag && (
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-snug whitespace-pre-wrap break-all">
                {diag}
              </pre>
            )}
          </CardContent>
        </Card>

        <div className="pt-8">
          <Button variant="destructive" className="w-full h-14 text-lg font-bold" onClick={() => logout()}>
            <LogOut className="w-5 h-5 mr-2" /> Log Out
          </Button>
        </div>
      </div>
    </div>
  );
}
