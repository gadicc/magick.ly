function compute(mothers: (1 | 2)[][]) {
  const daughters = [
    [mothers[0][0], mothers[1][0], mothers[2][0], mothers[3][0]], // heads
    [mothers[0][1], mothers[1][1], mothers[2][1], mothers[3][1]], // necks
    [mothers[0][2], mothers[1][2], mothers[2][2], mothers[3][2]], // bodies
    [mothers[0][3], mothers[1][3], mothers[2][3], mothers[3][3]], // feet
  ];

  const num = (x) => (x % 2 === 0 ? 2 : 1) as 1 | 2;
  const nephews = [
    [
      num(mothers[0][0] + mothers[1][0]),
      num(mothers[0][1] + mothers[1][1]),
      num(mothers[0][2] + mothers[1][2]),
      num(mothers[0][3] + mothers[1][3]),
    ],
    [
      num(mothers[2][0] + mothers[3][0]),
      num(mothers[2][1] + mothers[3][1]),
      num(mothers[2][2] + mothers[3][2]),
      num(mothers[2][3] + mothers[3][3]),
    ],
    [
      num(daughters[0][0] + daughters[1][0]),
      num(daughters[0][1] + daughters[1][1]),
      num(daughters[0][2] + daughters[1][2]),
      num(daughters[0][3] + daughters[1][3]),
    ],
    [
      num(daughters[2][0] + daughters[3][0]),
      num(daughters[2][1] + daughters[3][1]),
      num(daughters[2][2] + daughters[3][2]),
      num(daughters[2][3] + daughters[3][3]),
    ],
  ];

  const witnesses = [
    [
      num(nephews[0][0] + nephews[1][0]),
      num(nephews[0][1] + nephews[1][1]),
      num(nephews[0][2] + nephews[1][2]),
      num(nephews[0][3] + nephews[1][3]),
    ],
    [
      num(nephews[2][0] + nephews[3][0]),
      num(nephews[2][1] + nephews[3][1]),
      num(nephews[2][2] + nephews[3][2]),
      num(nephews[2][3] + nephews[3][3]),
    ],
  ];

  const judges = [
    [
      num(witnesses[0][0] + witnesses[1][0]),
      num(witnesses[0][1] + witnesses[1][1]),
      num(witnesses[0][2] + witnesses[1][2]),
      num(witnesses[0][3] + witnesses[1][3]),
    ],
  ];

  return { mothers, daughters, nephews, witnesses, judges };
}

export { compute };
