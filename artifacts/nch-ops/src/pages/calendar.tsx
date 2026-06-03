import { useListAppointments } from "@workspace/api-client-react";
import { useState } from "react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, MapPin } from "lucide-react";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";

export default function Calendar() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const formattedDate = date ? format(date, "yyyy-MM-dd") : undefined;
  
  const { data: appointments, isLoading } = useListAppointments({
    date: formattedDate,
  });

  const getOwnerColor = (role: string) => {
    switch (role) {
      case "mike": return "bg-blue-500";
      case "jack": return "bg-amber-500";
      case "jacob": return "bg-red-500";
      default: return "bg-gray-500";
    }
  };

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-2xl font-bold">Calendar</h1>
      </div>

      <div className="p-4 space-y-6">
        <Card className="p-2 flex justify-center">
          <CalendarComponent
            mode="single"
            selected={date}
            onSelect={setDate}
            className="rounded-md"
          />
        </Card>

        <div>
          <h2 className="text-lg font-bold mb-3">
            {date ? format(date, "MMMM do, yyyy") : "Appointments"}
          </h2>
          
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : appointments?.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground bg-muted/50 rounded-xl border border-dashed">
              No appointments scheduled for this date.
            </div>
          ) : (
            <div className="space-y-3">
              {appointments?.map((apt) => (
                <Card key={apt.id} className="overflow-hidden border-l-4" style={{ borderLeftColor: `var(--${apt.ownerRole === 'jacob' ? 'primary' : apt.ownerRole === 'jack' ? 'amber-500' : 'blue-500'})` }}>
                  <CardContent className="p-4">
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center justify-center min-w-[60px] pr-3 border-r">
                        <span className="text-sm font-bold">{format(new Date(apt.startTime), "h:mm")}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(apt.startTime), "a")}</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg leading-tight">{apt.title}</h3>
                        {apt.location && (
                          <p className="text-sm text-muted-foreground flex items-center mt-1">
                            <MapPin className="w-3 h-3 mr-1 shrink-0" />
                            <span className="truncate">{apt.location}</span>
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${getOwnerColor(apt.ownerRole)}`}></span>
                          <span className="text-xs font-medium capitalize">{apt.ownerRole}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
