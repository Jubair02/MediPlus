'use client'

import type { PanelProps } from '../Dashboard'
import PanelTransition from '../PanelTransition'
import AdminOverview from '@/components/admin/AdminOverview'
import AdminOrders from '@/components/admin/AdminOrders'
import AdminPayments from '@/components/admin/AdminPayments'
import AdminMedicines from '@/components/admin/AdminMedicines'
import AdminCategories from '@/components/admin/AdminCategories'
import AdminCoupons from '@/components/admin/AdminCoupons'
import AdminUsers from '@/components/admin/AdminUsers'
import AdminStaff from '@/components/admin/AdminStaff'
import AdminReports from '@/components/admin/AdminReports'
import AdminAuditLog from '@/components/admin/AdminAuditLog'
import StockRequests from '@/components/inventory/StockRequests'
import StockLog from '@/components/pharmacist/StockLog'

/** Panel bodies for ADMIN. The shell owns the frame; this owns only the content. */
export default function AdminPanels({ sectionId, goto }: PanelProps) {
  return <PanelTransition sectionId={sectionId}>{body(sectionId, goto)}</PanelTransition>
}

function body(sectionId: string, goto: (id: string) => void) {
  switch (sectionId) {
    case 'admin:overview':
      return <AdminOverview onViewAllOrders={() => goto('admin:orders')} />
    case 'admin:orders':
      return <AdminOrders />
    case 'admin:payments':
      return <AdminPayments />
    case 'admin:medicines':
      return <AdminMedicines />
    case 'admin:stock-requests':
      // An admin lands on the review queue: what is waiting on them, not what they raised.
      return <StockRequests defaultFilter="SUBMITTED" />
    case 'admin:stocklog':
      return <StockLog />
    case 'admin:categories':
      return <AdminCategories />
    case 'admin:coupons':
      return <AdminCoupons />
    case 'admin:users':
      return <AdminUsers />
    case 'admin:staff':
      return <AdminStaff />
    case 'admin:reports':
      return <AdminReports />
    case 'admin:audit':
      return <AdminAuditLog />
    default:
      return null
  }
}
