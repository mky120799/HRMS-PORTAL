import mongoose, { Schema } from 'mongoose';

const LeaveRequestSchema = new Schema({
  tenantId: { type: String, required: true, index: true },
  employeeId: { type: String, required: true, index: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  type: { type: String, default: 'ANNUAL' },
  status: { type: String, default: 'PENDING' },
  reason: { type: String },
}, { timestamps: true, collection: 'leave_requests' });

LeaveRequestSchema.index({ tenantId: 1, employeeId: 1, createdAt: -1 });

export const LeaveRequest = mongoose.model('LeaveRequest', LeaveRequestSchema);

export async function connectDb(uri: string) {
  await mongoose.connect(uri);
}
