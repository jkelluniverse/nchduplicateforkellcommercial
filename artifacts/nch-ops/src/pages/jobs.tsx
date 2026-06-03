import { useListJobs } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Jobs() {
  const { data: jobs, isLoading } = useListJobs();

  const getStatusColor = (status: string) => {
    switch (status) {
      case "estimate": return "bg-gray-500";
      case "deposit_received": return "bg-blue-500";
      case "in_progress": return "bg-amber-500";
      case "invoiced": return "bg-purple-500";
      case "paid": return "bg-green-500";
      case "complete": return "bg-green-500";
      case "closed": return "bg-gray-800";
      default: return "bg-gray-500";
    }
  };

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 flex justify-between items-center shadow-md">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <Link href="/jobs/new">
          <Button size="sm" variant="secondary" className="h-9">
            <Plus className="w-4 h-4 mr-1" /> New Job
          </Button>
        </Link>
      </div>

      <div className="bg-blue-50 border-b border-blue-100 px-4 py-2.5 flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700 leading-snug">
          <span className="font-semibold">Job-specific expenses</span> are added inside each job. Select the job you'd like to add an expense to.
        </p>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))
        ) : jobs?.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">No jobs found.</div>
        ) : (
          jobs?.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`}>
              <Card className={`overflow-hidden border-l-4 ${job.isOverBudget ? 'border-l-destructive' : 'border-l-primary'} hover-elevate cursor-pointer mb-3`}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-bold text-lg">#{job.jobNumber}</span>
                    <Badge className={`${getStatusColor(job.status)} text-white border-0`}>
                      {job.status.replace("_", " ").toUpperCase()}
                    </Badge>
                  </div>
                  <h3 className="font-semibold text-lg">{job.client}</h3>
                  <p className="text-muted-foreground text-sm mb-3 line-clamp-1">{job.address}</p>
                  
                  <div className="flex justify-between items-end">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Est:</span> ${job.estimateAmount?.toLocaleString()}
                      <br />
                      <span className="text-muted-foreground">Cost:</span> <span className={job.isOverBudget ? 'text-destructive font-bold' : ''}>${job.totalCosts?.toLocaleString()}</span>
                    </div>
                    {job.marginPercent !== undefined && (
                      <div className="text-right">
                        <span className="text-xs text-muted-foreground block">Margin</span>
                        <span className={`font-bold ${job.marginPercent < 15 ? 'text-amber-500' : 'text-green-500'}`}>
                          {job.marginPercent.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
