import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, TrendingUp, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useState } from 'react';

export function PerformancePage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [selectedReview, setSelectedReview] = useState<any>(null);
  const [rating, setRating] = useState('');
  const [comments, setComments] = useState('');

  const user = useQuery({ queryKey: ['me'], queryFn: async () => (await api.get('/auth/me')).data });
  const myReviews = useQuery({ queryKey: ['performance', 'me'], queryFn: async () => (await api.get('/performance/me')).data });
  const teamReviews = useQuery({ 
    queryKey: ['performance', 'team'], 
    queryFn: async () => (await api.get('/performance/team')).data,
    enabled: user.data?.role === 'ADMIN' || user.data?.role === 'MANAGER'
  });

  const createCycle = useMutation({
    mutationFn: async () => api.post('/performance/cycle', { cycleName: 'Q3 2026 Review' }),
    onSuccess: () => {
      showToast('New review cycle initiated', 'success');
      qc.invalidateQueries({ queryKey: ['performance'] });
    }
  });

  const submitSelf = useMutation({
    mutationFn: async (id: string) => api.patch(`/performance/${id}/self`, { selfRating: parseInt(rating), comments }),
    onSuccess: () => {
      showToast('Self review submitted');
      setSelectedReview(null);
      qc.invalidateQueries({ queryKey: ['performance'] });
    }
  });

  const submitManager = useMutation({
    mutationFn: async (id: string) => api.patch(`/performance/${id}/manager`, { managerRating: parseInt(rating), comments }),
    onSuccess: () => {
      showToast('Manager review completed');
      setSelectedReview(null);
      qc.invalidateQueries({ queryKey: ['performance'] });
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Performance & OKRs</h2>
          <p className="text-muted-foreground mt-2">Track quarterly reviews and goal progression.</p>
        </div>
        {user.data?.role === 'ADMIN' && (
          <Button onClick={() => createCycle.mutate()} className="bg-indigo-600 hover:bg-indigo-700">
            <Target size={16} className="mr-2" /> Start Review Cycle
          </Button>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-white/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp size={18} className="text-indigo-500" /> My Reviews
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {myReviews.data?.map((review: any) => (
              <div key={review.id} className="border p-4 rounded-xl bg-white/60">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-semibold">{review.cycleName}</h3>
                  <Badge variant="secondary">{review.status}</Badge>
                </div>
                
                {review.status === 'DRAFT' && (
                  <div className="mt-4">
                    <p className="text-sm text-muted-foreground mb-2">Please submit your self-evaluation:</p>
                    <Select onValueChange={setRating}>
                      <SelectTrigger className="mb-2"><SelectValue placeholder="Rating (1-5)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 - Needs Improvement</SelectItem>
                        <SelectItem value="3">3 - Meets Expectations</SelectItem>
                        <SelectItem value="5">5 - Exceeds Expectations</SelectItem>
                      </SelectContent>
                    </Select>
                    <Textarea 
                      placeholder="Summary of achievements..." 
                      className="mb-2"
                      onChange={(e: any) => setComments(e.target.value)}
                    />
                    <Button onClick={() => submitSelf.mutate(review.id)} size="sm" className="w-full">
                      Submit Self Review
                    </Button>
                  </div>
                )}
                
                {review.status !== 'DRAFT' && (
                  <div className="text-sm space-y-2 mt-2 bg-slate-50 p-3 rounded-md">
                    <div><strong>Self Rating:</strong> {review.selfRating}/5</div>
                    {review.status === 'COMPLETED' && (
                      <div><strong>Manager Rating:</strong> {review.managerRating}/5</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!myReviews.data?.length && <p className="text-muted-foreground text-sm">No reviews found.</p>}
          </CardContent>
        </Card>

        {(user.data?.role === 'ADMIN' || user.data?.role === 'MANAGER') && (
          <Card className="bg-white/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-500" /> Team Reviews Pending
              </CardTitle>
              <CardDescription>Reviews submitted by your reports needing your evaluation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {teamReviews.data?.map((review: any) => (
                <div key={review.id} className="border p-4 rounded-xl bg-white/60">
                  <div className="font-semibold">{review.employee.firstName} {review.employee.lastName}</div>
                  <div className="text-sm text-muted-foreground mb-4">{review.cycleName}</div>
                  
                  <div className="text-sm bg-slate-50 p-3 rounded-md mb-4 italic">
                    "{review.comments}" - (Self Rating: {review.selfRating}/5)
                  </div>

                  <Select onValueChange={setRating}>
                    <SelectTrigger className="mb-2"><SelectValue placeholder="Manager Rating (1-5)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 - Needs Improvement</SelectItem>
                      <SelectItem value="3">3 - Meets Expectations</SelectItem>
                      <SelectItem value="5">5 - Exceeds Expectations</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea 
                    placeholder="Manager feedback..." 
                    className="mb-2"
                    onChange={(e: any) => setComments(e.target.value)}
                  />
                  <Button onClick={() => submitManager.mutate(review.id)} size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700">
                    Submit Evaluation
                  </Button>
                </div>
              ))}
              {!teamReviews.data?.length && <p className="text-muted-foreground text-sm">No pending team reviews.</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
