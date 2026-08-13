import { lazy } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";

// Route-level code splitting — each page loads only when navigated to
const Home = lazy(() => import("./pages/Home"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const OrgShowcase = lazy(() => import("./pages/OrgShowcase"));
const Sandbox = lazy(() => import("./pages/Sandbox"));
const TemplateMarketplace = lazy(() => import("./pages/TemplateMarketplace"));
const CommunityHub = lazy(() => import("./pages/CommunityHub"));
const CommunityHubIndex = lazy(() => import("./pages/CommunityHubIndex"));
const Servers = lazy(() => import("./pages/Servers"));
const Users = lazy(() => import("./pages/Users"));
const SecurityLanding = lazy(() => import("./pages/SecurityLanding"));
const AGDashboard = lazy(() => import("./pages/AGDashboard"));
const AGPrivacy = lazy(() => import("./pages/AGPrivacy"));
const AGTerms = lazy(() => import("./pages/AGTerms"));
const AGLicense = lazy(() => import("./pages/AGLicense"));
const AGFeatures = lazy(() => import("./pages/AGFeatures"));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/u/:username" element={<UserProfile />} />
        <Route path="/o/:org/:company" element={<OrgShowcase />} />
        <Route path="/s/:org/:project" element={<Sandbox />} />
        <Route path="/T" element={<TemplateMarketplace />} />
        <Route path="/C/💬" element={<CommunityHub />} />
        <Route path="/C/:username/:project" element={<CommunityHub />} />
        <Route path="/C/:username" element={<CommunityHub />} />
        <Route path="/C" element={<CommunityHubIndex />} />
        <Route path="/S" element={<Servers />} />
        <Route path="/U" element={<Users />} />
        <Route path="/F" element={<SecurityLanding />} />
        <Route path="/ag" element={<AGDashboard />} />
        <Route path="/ag/privacy" element={<AGPrivacy />} />
        <Route path="/ag/terms" element={<AGTerms />} />
        <Route path="/ag/license" element={<AGLicense />} />
        <Route path="/ag/features" element={<AGFeatures />} />
        <Route path="*" element={<SecurityLanding />} />
      </Route>
    </Routes>
  );
}
