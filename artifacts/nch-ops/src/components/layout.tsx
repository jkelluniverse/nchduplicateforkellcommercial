import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { Home, Briefcase, CheckSquare, MessageCircle, Grid, Contact } from "lucide-react";
import { useGetUnreadMessageCount, getGetUnreadMessageCountQueryKey, useListTasks, getListTasksQueryKey } from "@workspace/api-client-react";
import { NotificationBanner } from "@/components/NotificationBanner";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();

  // Redirect if not logged in
  if (!user) {
    return <>{children}</>;
  }

  const { data: unreadCount } = useGetUnreadMessageCount({
    query: { enabled: !!user, queryKey: getGetUnreadMessageCountQueryKey() },
  });

  const { data: allTasks } = useListTasks(undefined, {
    query: { enabled: !!user, queryKey: getListTasksQueryKey() },
  });
  const myPendingTaskCount = (allTasks ?? []).filter(
    (t) => t.assignedTo === user.role && t.status !== "done",
  ).length;

  const isActive = (path: string) => {
    if (path === "/" && location !== "/") return false;
    if (path !== "/" && location.startsWith(path)) return true;
    return location === path;
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground pb-20">
      <NotificationBanner />
      <main className="flex-1 w-full max-w-md mx-auto relative bg-background shadow-xl">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 px-2 pb-safe">
        <div className="flex justify-between items-center max-w-md mx-auto h-16">
          <Link href="/" className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${isActive("/") ? "text-primary" : "text-muted-foreground"}`}>
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-medium">Home</span>
          </Link>
          
          <Link href="/jobs" className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${isActive("/jobs") ? "text-primary" : "text-muted-foreground"}`}>
            <Briefcase className="w-5 h-5" />
            <span className="text-[10px] font-medium">Jobs</span>
          </Link>
          
          <Link href="/tasks" className={`flex flex-col items-center justify-center w-full h-full space-y-1 relative ${isActive("/tasks") ? "text-primary" : "text-muted-foreground"}`}>
            <div className="relative">
              <CheckSquare className="w-5 h-5" />
              {myPendingTaskCount > 0 ? (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center">
                  {myPendingTaskCount}
                </span>
              ) : null}
            </div>
            <span className="text-[10px] font-medium">Tasks</span>
          </Link>
          
          <Link href="/messages" className={`flex flex-col items-center justify-center w-full h-full space-y-1 relative ${isActive("/messages") ? "text-primary" : "text-muted-foreground"}`}>
            <div className="relative">
              <MessageCircle className="w-5 h-5" />
              {unreadCount?.count ? (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center">
                  {unreadCount.count}
                </span>
              ) : null}
            </div>
            <span className="text-[10px] font-medium">Messages</span>
          </Link>

          <Link href="/directory" className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${isActive("/directory") ? "text-primary" : "text-muted-foreground"}`}>
            <Contact className="w-5 h-5" />
            <span className="text-[10px] font-medium">Directory</span>
          </Link>
          
          <Link href="/more" className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${isActive("/more") ? "text-primary" : "text-muted-foreground"}`}>
            <Grid className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
