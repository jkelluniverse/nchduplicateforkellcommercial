import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Settings, Building2, Contact, CircleCheck as CheckCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function More() {
  const { logout } = useAuth();

  const links = [
    { href: "/properties", icon: <Building2 className="w-6 h-6" />, title: "Properties", desc: "Properties, units & payment status" },
    { href: "/tasks", icon: <CheckCircle className="w-6 h-6" />, title: "Tasks", desc: "Your personal task list" },
    { href: "/directory", icon: <Contact className="w-6 h-6" />, title: "Directory", desc: "Tenant & contact directory" },
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

        <div className="pt-8">
          <Button variant="destructive" className="w-full h-14 text-lg font-bold" onClick={() => logout()}>
            <LogOut className="w-5 h-5 mr-2" /> Log Out
          </Button>
        </div>
      </div>
    </div>
  );
}
