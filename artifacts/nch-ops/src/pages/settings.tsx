import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogOut, User as UserIcon, Mail, Phone, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NudgeSettingsCard } from "@/features/followup/nudge-settings-card";

export default function Settings() {
  const { user, logout } = useAuth();

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <div className="p-4 space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary border-2 border-primary/20">
                <UserIcon className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{user?.name}</h2>
                <Badge variant="secondary" className="mt-1 uppercase tracking-wider">{user?.role}</Badge>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground flex items-center mb-1">
                  <UserIcon className="w-4 h-4 mr-2" /> Username
                </p>
                <p className="font-medium">{user?.username}</p>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground flex items-center mb-1">
                  <Mail className="w-4 h-4 mr-2" /> Email
                </p>
                <p className="font-medium">{user?.email || "Not provided"}</p>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground flex items-center mb-1">
                  <Phone className="w-4 h-4 mr-2" /> Phone
                </p>
                <p className="font-medium">{user?.phone || "Not provided"}</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground flex items-center mb-1">
                  <Shield className="w-4 h-4 mr-2" /> Access Level
                </p>
                <p className="font-medium capitalize">{user?.role === 'jacob' ? 'Full Administrator' : 'Standard User'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {user?.role === "jacob" && <NudgeSettingsCard />}

        <Button variant="destructive" className="w-full h-14 text-lg font-bold" onClick={() => logout()}>
          <LogOut className="w-5 h-5 mr-2" /> Sign Out
        </Button>
        
        <p className="text-center text-xs text-muted-foreground">
          Kell Commercial Leasing v1.0.0<br/>
          &copy; {new Date().getFullYear()} Kell Commercial
        </p>
      </div>
    </div>
  );
}
