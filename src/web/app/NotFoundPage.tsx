import { Link } from 'react-router';
import { PageHeader } from '../components/ui/PageHeader';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Not found" />
      <p className="py-8">
        There is nothing at this address. <Link to="/">Go to Today</Link>
      </p>
    </>
  );
}
