function toPublicUser(user) {
  if (!user) {
    return null;
  }

  const source = typeof user.toObject === 'function' ? user.toObject() : user;

  return {
    id: String(source._id || source.id),
    name: source.name,
    email: source.email,
    role: source.role,
    isActive: source.isActive,
    isLineBound: Boolean(source.lineUserId),
    lineBindAt: source.lineBindAt || null,
    activeCourseId: source.activeCourseId ? String(source.activeCourseId) : null,
    lineConversationState: source.lineConversationState ?? 'idle',
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

module.exports = {
  toPublicUser,
};
