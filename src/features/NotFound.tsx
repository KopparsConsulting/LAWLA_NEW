import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState title="Sidan finns inte">
      <Link to="/" className="text-accent underline">
        Till rättsutredningarna
      </Link>
    </EmptyState>
  );
}
