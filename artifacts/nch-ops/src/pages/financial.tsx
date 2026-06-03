import { useGetFinancialSummary } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, Briefcase, FileSpreadsheet, Activity } from "lucide-react";

export default function Financial() {
  const { user } = useAuth();
  const { data: summary, isLoading } = useGetFinancialSummary();

  const isJacob = user?.role === "jacob";

  if (isLoading) {
    return <div className="p-4 pt-12"><Skeleton className="h-64 w-full" /></div>;
  }

  const getHealthColor = (status: string) => {
    switch (status) {
      case "healthy": return "text-green-500";
      case "attention_needed": return "text-amber-500";
      case "critical": return "text-destructive";
      default: return "text-foreground";
    }
  };

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-2xl font-bold">Financial Overview</h1>
      </div>

      <div className="p-4 space-y-4">
        <Card className="border-0 shadow-md bg-gradient-to-br from-card to-muted">
          <CardContent className="p-6 text-center">
            <Activity className={`w-12 h-12 mx-auto mb-3 ${getHealthColor(summary?.healthStatus || '')}`} />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Company Health</h2>
            <p className={`text-2xl font-bold mt-1 capitalize ${getHealthColor(summary?.healthStatus || '')}`}>
              {summary?.healthStatus?.replace("_", " ")}
            </p>
          </CardContent>
        </Card>

        {isJacob && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Monthly Rev</p>
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  </div>
                  <p className="text-2xl font-bold mt-2">${summary?.monthlyRevenue?.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Monthly Exp</p>
                    <TrendingDown className="w-4 h-4 text-destructive" />
                  </div>
                  <p className="text-2xl font-bold mt-2">${summary?.monthlyExpenses?.toLocaleString()}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Net Cash Position</p>
                  <p className={`text-3xl font-bold mt-1 ${(summary?.netCashPosition || 0) >= 0 ? 'text-green-500' : 'text-destructive'}`}>
                    ${summary?.netCashPosition?.toLocaleString()}
                  </p>
                </div>
                <DollarSign className={`w-10 h-10 ${(summary?.netCashPosition || 0) >= 0 ? 'text-green-500/20' : 'text-destructive/20'}`} />
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Outstanding Invs</p>
                    <FileSpreadsheet className="w-4 h-4 text-amber-500" />
                  </div>
                  <p className="text-xl font-bold mt-2">${summary?.outstandingInvoicesTotal?.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Active Jobs</p>
                    <Briefcase className="w-4 h-4 text-primary" />
                  </div>
                  <p className="text-xl font-bold mt-2">{summary?.activeJobsCount}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground mb-2">ICONN Placements YTD</p>
                <div className="flex justify-between items-end">
                  <span className="text-2xl font-bold">{summary?.ytdIconnPlacements}</span>
                  <span className="text-xl font-semibold text-green-500">${summary?.ytdIconnRevenue?.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
