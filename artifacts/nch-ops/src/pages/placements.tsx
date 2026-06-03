import { useListPlacements, useGetPlacementsSummary, useMarkPlacementPaid, getListPlacementsQueryKey, getGetPlacementsSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CheckCircle2, TrendingUp, CircleDollarSign } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Placements() {
  const { data: placements, isLoading } = useListPlacements();
  const { data: summary, isLoading: summaryLoading } = useGetPlacementsSummary();
  const markPaid = useMarkPlacementPaid();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleMarkPaid = async (id: number) => {
    try {
      await markPaid.mutateAsync({ placementId: id });
      queryClient.invalidateQueries({ queryKey: getListPlacementsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPlacementsSummaryQueryKey() });
      toast({ title: "Marked as paid" });
    } catch (e) {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-2xl font-bold">ICONN Placements</h1>
      </div>

      <div className="p-4 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">YTD Placements</p>
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold mt-2">
                {summaryLoading ? <Skeleton className="h-8 w-8" /> : summary?.ytdCount || 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">YTD Revenue</p>
                <CircleDollarSign className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold mt-2 text-green-600">
                {summaryLoading ? <Skeleton className="h-8 w-16" /> : `$${summary?.ytdRevenue?.toLocaleString() || 0}`}
              </p>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-lg font-bold mb-3">Recent Placements</h2>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : placements?.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">No placements found.</div>
          ) : (
            placements?.map((p) => (
              <Card key={p.id} className={`mb-3 hover-elevate ${p.paymentStatus === 'unpaid' ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-green-500'}`}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-lg">{p.address}</h3>
                    <Badge variant={p.paymentStatus === 'paid' ? 'default' : 'outline'} className={p.paymentStatus === 'paid' ? 'bg-green-500' : 'text-amber-500 border-amber-500'}>
                      {p.paymentStatus.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">{p.residentName}</p>
                  <div className="flex justify-between items-end mt-3">
                    <span className="text-sm">{format(new Date(p.placementDate), "MMM d, yyyy")}</span>
                    {p.paymentStatus === 'unpaid' && (
                      <Button size="sm" onClick={() => handleMarkPaid(p.id)} disabled={markPaid.isPending}>
                        Mark Paid
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
