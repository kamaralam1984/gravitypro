import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { geofenceAPI } from '../services/api'

export const useGeofences = (circleId) => {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['geofences', circleId],
    queryFn: () => geofenceAPI.getByCircle(circleId),
    enabled: !!circleId,
    staleTime: 60_000,
    select: (data) => data.safe_zones || [],
  })

  const createMutation = useMutation({
    mutationFn: geofenceAPI.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['geofences', circleId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: geofenceAPI.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['geofences', circleId] }),
  })

  return {
    geofences: query.data || [],
    isLoading: query.isLoading,
    createGeofence: createMutation.mutateAsync,
    deleteGeofence: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
