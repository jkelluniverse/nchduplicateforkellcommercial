import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import nchLogo from "@/assets/nch-logo.png";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login({ username, password });
    } catch (err: any) {
      toast({
        title: "Login failed",
        description: err?.message || "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1 text-center">
          <img
            src={nchLogo}
            alt="Nice City Homes"
            className="mx-auto mb-4 h-24 w-auto object-contain"
          />
          <CardTitle className="text-2xl font-bold tracking-tight">NCH Operations</CardTitle>
          <CardDescription>Command Center Login</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="mike, jack, or jacob"
                required
                className="h-12 text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 text-lg"
              />
            </div>
            <Button type="submit" className="w-full h-12 text-lg font-medium mt-2" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
          
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setUsername("mike")}>Mike</Button>
            <Button variant="outline" size="sm" onClick={() => setUsername("jack")}>Jack</Button>
            <Button variant="outline" size="sm" onClick={() => setUsername("jacob")}>Jacob</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
