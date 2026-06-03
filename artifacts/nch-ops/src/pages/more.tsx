import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Settings, FileText, CircleCheck as CheckCircle, MapPin, FileSpreadsheet, ChartPie as PieChart, LogOut, Calendar, HardDrive, BookOpen, Hop as Home, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function More() {
  const { user, logout } = useAuth();

  const links = [
    { href: "/docs", icon: <BookOpen className="w-6 h-6" />, title: "Document Maker", desc: "Generate legal notices, receipts, land contracts & more" },
    { href: "/expenses", icon: <FileText className="w-6 h-6" />, title: "General Operating Expenses", desc: "View & Log general expenses. This is NOT for Job expenses" },
    { href: "/forms", icon: <ClipboardList className="w-6 h-6" />, title: "Forms", desc: "Tenant application & utility account forms" },
    { href: "/available-properties", icon: <Home className="w-6 h-6" />, title: "Available Properties", desc: "Homes for sale on land contract — manage list & PDF flyer" },
    { href: "/invoices", icon: <FileSpreadsheet className="w-6 h-6" />, title: "Invoices", desc: "View estimates and invoices" },
    { href: "/calendar", icon: <Calendar className="w-6 h-6" />, title: "Calendar", desc: "Appointments and schedule" },
    { href: "/drive", icon: <HardDrive className="w-6 h-6" />, title: "Drive Search", desc: "Search NCH files and records on the go" },
    { href: "/financial", icon: <PieChart className="w-6 h-6" />, title: "Financial", desc: "Company overview and cash position", role: "jacob" },
    { href: "/settings", icon: <Settings className="w-6 h-6" />, title: "Settings", desc: "App preferences and account" },
  ];

  return (
    <div className="pb-24">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-2xl font-bold">More</h1>
      </div>

      <div className="p-4 space-y-3">
        {links.map((link) => {
          if (link.role && user?.role !== link.role) return null;
          
          return (
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
          );
        })}
        
        <div className="pt-8">
          <Button variant="destructive" className="w-full h-14 text-lg font-bold" onClick={() => logout()}>
            <LogOut className="w-5 h-5 mr-2" /> Log Out
          </Button>
        </div>
      </div>
    </div>
  );
}
