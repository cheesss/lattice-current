export function createWhereBuilder(initialConditions = [], initialParams = []) {
  const conditions = [...initialConditions];
  const params = [...initialParams];

  return {
    addRaw(condition) {
      if (condition) conditions.push(String(condition));
      return this;
    },
    addValue(value, conditionFactory) {
      params.push(value);
      const placeholder = `$${params.length}`;
      conditions.push(conditionFactory(placeholder));
      return this;
    },
    build() {
      return {
        params,
        conditions,
        whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      };
    },
  };
}
