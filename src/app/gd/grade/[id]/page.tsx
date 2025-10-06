import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import { decycle } from "cycle";
import Data from "@/../data/data";

import GradeTree from "@/components/gd/GradeTree";
import Link from "@/lib/link";

const grades = Data.gdGrade;

export function generateStaticParams() {
  return Object.values(grades).map(({ id }) => ({ id }));
}

export default async function Planet(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const id = decodeURIComponent(params.id);
  if (!id) return "No id param given";

  const grade = grades[id];
  if (!grade) return "Could not find grade: " + id;

  return (
    <>
      <style>{`
        div.nav {
          display: table;
          width: 100%;
        }
        div.nav > div {
          display: table-cell;
          vertical-align: middle;
        }
        div.prevNext {
          font-size: 150%;
        }
      `}</style>
      <Container maxWidth="sm">
        <Box my={4}>
          <div className="nav">
            <div className="prevNext">
              {grade.prev && (
                <Link href={grade.prev} underline="none">
                  ❮
                </Link>
              )}
            </div>
            <div>
              {grade.sephirah ? (
                <GradeTree
                  height="150px"
                  topText=""
                  active={grade.sephirah.id}
                />
              ) : (
                <span>(no sephirah)</span>
              )}
            </div>
            <div className="prevNext">
              {grade.next && (
                <Link href={grade.next} underline="none">
                  ❯
                </Link>
              )}
            </div>
          </div>
          <br />

          <p>
            <i>
              {grade.name} ({grade.id})
            </i>
          </p>

          <table>
            <tbody>
              {Object.keys(grade).map((key) => {
                let json;
                try {
                  json = JSON.stringify(decycle(grade[key]));
                } catch (error) {
                  console.warn(error);
                  return;
                }
                return (
                  json && (
                    <tr key={key}>
                      <td>{key}</td>
                      <td>{json}</td>
                    </tr>
                  )
                );
              })}
            </tbody>
          </table>
        </Box>
      </Container>
    </>
  );
}
