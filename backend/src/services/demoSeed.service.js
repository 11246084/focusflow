const bcrypt = require('bcryptjs');
const User = require('../models/user.model');
const { USER_ROLES } = require('../constants/enums');

const DEMO_USERS = [
  {
    name: 'Demo Teacher',
    email: 'teacher@focusflow.local',
    password: 'Teacher123!',
    role: USER_ROLES.TEACHER,
  },
  {
    name: 'Demo Student',
    email: 'student@focusflow.local',
    password: 'Student123!',
    role: USER_ROLES.STUDENT,
  },
  {
    name: 'Demo Admin',
    email: 'admin@focusflow.local',
    password: 'Admin123!',
    role: USER_ROLES.ADMIN,
  },
];

async function seedDemoUsers({ silent = false } = {}) {
  for (const demoUser of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(demoUser.password, 10);

    await User.findOneAndUpdate(
      { email: demoUser.email },
      {
        $set: {
          name: demoUser.name,
          email: demoUser.email,
          passwordHash,
          role: demoUser.role,
          isActive: true,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  }

  if (!silent) {
    console.log('Demo users seeded.');
  }

  return DEMO_USERS.map(({ passwordHash, ...user }) => user);
}

module.exports = {
  DEMO_USERS,
  seedDemoUsers,
};
