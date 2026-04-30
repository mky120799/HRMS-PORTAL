import axios from 'axios';

async function seed() {
  console.log('Logging in as admin...');
  const loginRes = await axios.post('http://localhost:3000/api/v1/auth/login', {
    email: 'admin@zenith.com',
    password: 'Admin123!'
  });
  
  const token = loginRes.data.accessToken;
  
  console.log('Posting jobs...');
  const jobs = [
    { title: 'Senior Software Engineer', department: 'Engineering', description: 'We are looking for a Senior Software Engineer with a deep understanding of React, Node.js, and Microservices.' },
    { title: 'Product Marketing Manager', department: 'Marketing', description: 'Seeking a creative Product Marketing Manager to lead our GTM strategy. Experience in SaaS is required.' },
    { title: 'HR Generalist', department: 'Human Resources', description: 'Join our growing team as an HR Generalist! You will handle onboarding, employee relations, and use this very HRMS portal.' }
  ];

  for (const job of jobs) {
    await axios.post('http://localhost:3000/api/v1/hiring/jobs', job, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`Seeded job: ${job.title}`);
  }
}

seed().catch(console.error);
