import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";

// Pages
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Jobs from "@/pages/jobs";
import JobDetail from "@/pages/job-detail";
import NewJob from "@/pages/job-new";
import LogReceipt from "@/pages/job-receipt";
import Tasks from "@/pages/tasks";
import Messages from "@/pages/messages";
import More from "@/pages/more";
import Expenses from "@/pages/expenses";
import Placements from "@/pages/placements";
import Properties from "@/pages/properties";
import Invoices from "@/pages/invoices";
import Financial from "@/pages/financial";
import Settings from "@/pages/settings";
import Calendar from "@/pages/calendar";
import Drive from "@/pages/drive";
import Docs from "@/pages/docs";
import Directory from "@/pages/directory";
import AvailableProperties from "@/pages/available-properties";
import FormsPage from "@/pages/forms";
import PublicApply from "@/pages/public-apply";
import PublicUtilities from "@/pages/public-utilities";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>;
  }
  
  if (!user) {
    return <Redirect to="/login" />;
  }
  
  return <Component {...rest} />;
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>;
  }

  return (
    <Switch>
      <Route path="/apply">
        <PublicApply />
      </Route>

      <Route path="/utilities">
        <PublicUtilities />
      </Route>

      <Route path="/login">
        {user ? <Redirect to="/" /> : <Login />}
      </Route>
      
      <Route path="/">
        <Layout>
          <ProtectedRoute component={Dashboard} />
        </Layout>
      </Route>
      
      <Route path="/jobs/new">
        <Layout>
          <ProtectedRoute component={NewJob} />
        </Layout>
      </Route>
      
      <Route path="/jobs/:id/log-receipt">
        <Layout>
          <ProtectedRoute component={LogReceipt} />
        </Layout>
      </Route>
      
      <Route path="/jobs/:id">
        <Layout>
          <ProtectedRoute component={JobDetail} />
        </Layout>
      </Route>
      
      <Route path="/jobs">
        <Layout>
          <ProtectedRoute component={Jobs} />
        </Layout>
      </Route>
      
      <Route path="/tasks">
        <Layout>
          <ProtectedRoute component={Tasks} />
        </Layout>
      </Route>
      
      <Route path="/messages">
        <Layout>
          <ProtectedRoute component={Messages} />
        </Layout>
      </Route>
      
      <Route path="/more">
        <Layout>
          <ProtectedRoute component={More} />
        </Layout>
      </Route>
      
      <Route path="/expenses">
        <Layout>
          <ProtectedRoute component={Expenses} />
        </Layout>
      </Route>
      
      <Route path="/placements">
        <Layout>
          <ProtectedRoute component={Placements} />
        </Layout>
      </Route>
      
      <Route path="/properties">
        <Layout>
          <ProtectedRoute component={Properties} />
        </Layout>
      </Route>
      
      <Route path="/invoices">
        <Layout>
          <ProtectedRoute component={Invoices} />
        </Layout>
      </Route>
      
      <Route path="/financial">
        <Layout>
          <ProtectedRoute component={Financial} />
        </Layout>
      </Route>
      
      <Route path="/settings">
        <Layout>
          <ProtectedRoute component={Settings} />
        </Layout>
      </Route>

      <Route path="/calendar">
        <Layout>
          <ProtectedRoute component={Calendar} />
        </Layout>
      </Route>

      <Route path="/drive">
        <Layout>
          <ProtectedRoute component={Drive} />
        </Layout>
      </Route>

      <Route path="/docs">
        <Layout>
          <ProtectedRoute component={Docs} />
        </Layout>
      </Route>

      <Route path="/directory">
        <Layout>
          <ProtectedRoute component={Directory} />
        </Layout>
      </Route>

      <Route path="/forms">
        <Layout>
          <ProtectedRoute component={FormsPage} />
        </Layout>
      </Route>

      <Route path="/available-properties">
        <Layout>
          <ProtectedRoute component={AvailableProperties} />
        </Layout>
      </Route>
      
      <Route>
        <Layout>
          <NotFound />
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
