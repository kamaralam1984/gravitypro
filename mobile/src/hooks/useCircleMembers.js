import { useQuery } from '@tanstack/react-query'
import { circleAPI } from '../services/api'

export const useCircleMembers = (circleId) => {
  return useQuery({
    queryKey: ['circle-members', circleId],
    queryFn: () => circleAPI.getMembers(circleId),
    enabled: !!circleId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    select: (data) => data.members || [],
  })
}
