import React from 'react';
import { useRouter } from 'next/router'

import Container from '@material-ui/core/Container';
import Typography from '@material-ui/core/Typography';
import Box from '@material-ui/core/Box';

import ProTip from '../../../src/ProTip';
import Link from '../../../src/Link';
import Copyright from '../../../src/Copyright';

import AppBar from '../../../components/AppBar';
import TreeOfLife from '../../../components/kabbalah/TreeOfLife';

import Data from '../../../data/data';
const paths = Object.values(Data.tolPath);

export async function getStaticPaths() {
  const urlPaths = paths.map(path => '/kabbalah/path/' + path.id);
  return { paths: urlPaths, fallback: true };
}

export async function getStaticProps({ params: { id } }) {
  return { props: { id }};
}

export default function Sephirot() {
  const navParts = [ { title: 'ToL', url: '/kabbalah/tree' } ];

  const router = useRouter();

  const { id } = router.query;
  if (!id)
    return null;

  const path = paths.find(path => path.id === id);
  if (!path)
    return null;

  const otherLabels = Object.keys(path).filter(
    x => ![
      'id', 'hermetic', 'hebrew'
    ].includes(x)
  );

  const [ from, to ] = path.id.split('_').map(Number).map(
    i => Object.values(Data.sephirah).find(s => s.index === i)
  );
  console.log({ from, to });

  return (
    <>
      <style jsx>{`
        .hebrewLetter:nth-child(1) {
          width: 100px;
          border: 1px outset;
          background: #eee;
          text-align: center;
          padding: 5px;
        }
        .hebrewLetter > div:nth-child(1) {
          font-size: 500%;
          line-height: .8em;
        }

        table.main {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0 20px;
        }
        table.main td { display: table-cell; vertical-align: middle }
      `}</style>

      <AppBar title={path.id} navParts={navParts} />
      <Container maxWidth="sm">
        <Box my={4}>

          {/*
          <table width="100%">
            <style jsx>{`
              a.prevNextLink { text-decoration: none }
            `}</style>
            <tbody>
              <tr>
                <td>
                  <a className="prevNextLink" href="">
                    ⬅
                  </a>
                </td>
                <td>
                  <TreeOfLife height="80px" topText="" active={sephirah.id} />
                </td>
                <td>
                  <NameBlob name={sephirah.name} />
                </td>
                <td>
                  <a className="prevNextLink" href="">
                    ➡
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
          */}

        <div className="nav">
          <div className="prevNext">{path.prev && <Link href={path.prev} underline="none">❮</Link>}</div>
          <div><TreeOfLife height="150px" topText="" activePath={path.id} /></div>
          <div className="prevNext">{path.next && <Link href={path.next} underline="none">❯</Link>}</div>
         </div>
         <br />

          {/*
          <span style={{ right: 0, marginRight: 15, position: 'fixed' }}>
            <TreeOfLife width="80px" topText="" active={sephirah.id} />
          </span>
          */}

          <h1>
            Path {path.id.replace(/_/, '-')}
            {" "}
            ({from.name.romanization}-{to.name.romanization})
          </h1>

          <h2>Hermetic Tradition</h2>

          <table className="main">
            <tbody>

              <tr>
                <td>Hebrew Letter:</td>
                <td>
                  <div className="hebrewLetter">
                    <div>{path.hermetic.hebrewLetter.letter.he}</div>
                    <div>
                      {path.hermetic.hebrewLetter.letter.name}{" "}
                      ("{path.hermetic.hebrewLetter.letter.mathers}")
                    </div>
                  </div>
                </td>
              </tr>

              {
                otherLabels.map(key => (
                  <tr key={key}>
                    <td>{key.substr(0,1).toUpperCase() + key.substr(1)}:</td>
                    <td>{
                      typeof path[key] === 'string'
                        ? path[key].substr(0,1).toUpperCase() + path[key].substr(1)
                        : JSON.stringify(path[key])
                    }</td>
                  </tr>
                ))
              }
            </tbody>
          </table>

        </Box>
      </Container>
    </>
  );
}
